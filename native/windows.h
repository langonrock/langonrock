#include <windows.h>
typedef HANDLE store_handle;
#define INVALID_HANDLE INVALID_HANDLE_VALUE

static wchar_t *wide_path(const char *path) {
  int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, NULL, 0);
  if (size == 0) return NULL;
  wchar_t *wide = calloc((size_t)size, sizeof(wchar_t));
  if (wide == NULL) return NULL;
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, size)) {
    free(wide);
    return NULL;
  }
  return wide;
}

static int close_handle(store_handle handle) { return CloseHandle(handle) ? 0 : -1; }

static int lock_path(const char *path, bool shared, store_handle *result) {
  wchar_t *wide = wide_path(path);
  if (wide == NULL) return -1;
  HANDLE handle = CreateFileW(wide, GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  free(wide);
  if (handle == INVALID_HANDLE_VALUE) return -1;
  OVERLAPPED overlapped = {0};
  DWORD flags = LOCKFILE_FAIL_IMMEDIATELY | (shared ? 0 : LOCKFILE_EXCLUSIVE_LOCK);
  if (!LockFileEx(handle, flags, 0, 1, 0, &overlapped)) {
    DWORD failure = GetLastError();
    CloseHandle(handle);
    SetLastError(failure);
    return failure == ERROR_LOCK_VIOLATION ? 1 : -1;
  }
  *result = handle;
  return 0;
}

static int sync_path(const char *path, bool directory) {
  wchar_t *wide = wide_path(path);
  if (wide == NULL) return -1;
  HANDLE handle = CreateFileW(wide, GENERIC_READ | GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
    directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL, NULL);
  free(wide);
  if (handle == INVALID_HANDLE_VALUE) return -1;
  BOOL success = FlushFileBuffers(handle);
  DWORD failure = GetLastError();
  CloseHandle(handle);
  SetLastError(failure);
  return success ? 0 : -1;
}

static int replace_path(const char *source, const char *target) {
  wchar_t *from = wide_path(source);
  wchar_t *to = wide_path(target);
  if (from == NULL || to == NULL) { free(from); free(to); return -1; }
  BOOL success = MoveFileExW(from, to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
  DWORD failure = GetLastError();
  free(from);
  free(to);
  SetLastError(failure);
  return success ? 0 : -1;
}

static int order_path(const char *path) { return sync_path(path, false); }
