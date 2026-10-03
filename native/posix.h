#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
typedef int store_handle;
#define INVALID_HANDLE (-1)

static int close_handle(store_handle handle) { return close(handle); }

static int lock_path(const char *path, bool shared, store_handle *result) {
  int handle = open(path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (handle < 0) return -1;
  if (flock(handle, (shared ? LOCK_SH : LOCK_EX) | LOCK_NB) != 0) {
    int failure = errno;
    close(handle);
    errno = failure;
    return failure == EWOULDBLOCK || failure == EAGAIN ? 1 : -1;
  }
  *result = handle;
  return 0;
}

static int sync_path(const char *path, bool directory) {
  int handle = open(path, O_RDONLY | O_CLOEXEC | (directory ? O_DIRECTORY : 0));
  if (handle < 0) return -1;
#ifdef __APPLE__
  int status = directory ? fsync(handle) : fcntl(handle, F_FULLFSYNC);
#else
  int status = fsync(handle);
#endif
  int failure = errno;
  close(handle);
  errno = failure;
  return status;
}

static int replace_path(const char *source, const char *target) {
  return rename(source, target);
}

static int order_path(const char *path) {
#if defined(__APPLE__) && defined(F_BARRIERFSYNC)
  int handle = open(path, O_RDONLY | O_CLOEXEC);
  if (handle < 0) return -1;
  int status = fcntl(handle, F_BARRIERFSYNC);
  if (status != 0 && (errno == EINVAL || errno == ENOTSUP)) {
    status = fcntl(handle, F_FULLFSYNC);
  }
  int failure = errno;
  close(handle);
  errno = failure;
  return status;
#else
  return sync_path(path, false);
#endif
}
