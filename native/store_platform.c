#include "api.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include "windows.h"
#else
#include "posix.h"
#endif

typedef struct { store_handle handle; } owned_lock;

static napi_value failure(napi_env env, const char *operation) {
  char message[256];
#ifdef _WIN32
  snprintf(message, sizeof(message), "%s: Windows error %lu", operation, GetLastError());
#else
  snprintf(message, sizeof(message), "%s: %s", operation, strerror(errno));
#endif
  napi_throw_error(env, "STORE_PLATFORM", message);
  return NULL;
}

static bool arguments(napi_env env, napi_callback_info info, napi_value *values) {
  size_t count = 2;
  if (napi_get_cb_info(env, info, &count, values, NULL, NULL) != 0 || count < 1) {
    napi_throw_error(env, "STORE_ARGUMENT", "missing platform arguments");
    return false;
  }
  return true;
}

static char *path_argument(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != 0 || length > 32768) {
    napi_throw_error(env, "STORE_ARGUMENT", "invalid platform path");
    return NULL;
  }
  char *path = malloc(length + 1);
  if (path == NULL) { napi_throw_error(env, "STORE_MEMORY", "path allocation failed"); return NULL; }
  if (napi_get_value_string_utf8(env, value, path, length + 1, &length) != 0 || strlen(path) != length) {
    free(path);
    napi_throw_error(env, "STORE_ARGUMENT", "invalid platform path bytes");
    return NULL;
  }
  return path;
}

static void finalize_lock(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  owned_lock *lock = data;
  if (lock->handle != INVALID_HANDLE) close_handle(lock->handle);
  free(lock);
}

static napi_value acquire(napi_env env, napi_callback_info info) {
  napi_value values[2] = {0}, result;
  bool shared = false;
  if (!arguments(env, info, values)) return NULL;
  if (values[1] != NULL && napi_get_value_bool(env, values[1], &shared) != 0) {
    napi_throw_error(env, "STORE_ARGUMENT", "shared must be boolean"); return NULL;
  }
  char *path = path_argument(env, values[0]);
  if (path == NULL) return NULL;
  store_handle handle = INVALID_HANDLE;
  int status = lock_path(path, shared, &handle);
  free(path);
  if (status < 0) return failure(env, "acquire lock");
  if (status > 0) { napi_get_null(env, &result); return result; }
  owned_lock *lock = malloc(sizeof(*lock));
  if (lock == NULL) { close_handle(handle); napi_throw_error(env, "STORE_MEMORY", "lock allocation failed"); return NULL; }
  lock->handle = handle;
  if (napi_create_external(env, lock, finalize_lock, NULL, &result) != 0) {
    finalize_lock(env, lock, NULL); return NULL;
  }
  return result;
}

static napi_value release(napi_env env, napi_callback_info info) {
  napi_value values[2] = {0}, result;
  owned_lock *lock;
  if (!arguments(env, info, values)) return NULL;
  if (napi_get_value_external(env, values[0], (void **)&lock) != 0 || lock == NULL) {
    napi_throw_error(env, "STORE_ARGUMENT", "invalid lock handle"); return NULL;
  }
  if (lock->handle != INVALID_HANDLE) {
    store_handle handle = lock->handle;
    lock->handle = INVALID_HANDLE;
    if (close_handle(handle) != 0) return failure(env, "release lock");
  }
  napi_get_undefined(env, &result);
  return result;
}

static napi_value flush(napi_env env, napi_callback_info info) {
  napi_value values[2] = {0}, result;
  bool directory = false;
  if (!arguments(env, info, values)) return NULL;
  if (values[1] != NULL && napi_get_value_bool(env, values[1], &directory) != 0) {
    napi_throw_error(env, "STORE_ARGUMENT", "directory must be boolean"); return NULL;
  }
  char *path = path_argument(env, values[0]);
  if (path == NULL) return NULL;
  int status = sync_path(path, directory);
  free(path);
  if (status != 0) return failure(env, "flush path");
  napi_get_undefined(env, &result);
  return result;
}

static napi_value replace(napi_env env, napi_callback_info info) {
  napi_value values[2] = {0}, result;
  if (!arguments(env, info, values) || values[1] == NULL) return NULL;
  char *source = path_argument(env, values[0]);
  if (source == NULL) return NULL;
  char *target = path_argument(env, values[1]);
  if (target == NULL) { free(source); return NULL; }
  int status = replace_path(source, target);
  free(source); free(target);
  if (status != 0) return failure(env, "replace path");
  napi_get_undefined(env, &result);
  return result;
}

static napi_value order(napi_env env, napi_callback_info info) {
  napi_value values[2] = {0}, result;
  if (!arguments(env, info, values)) return NULL;
  char *path = path_argument(env, values[0]);
  if (path == NULL) return NULL;
  int status = order_path(path);
  free(path);
  if (status != 0) return failure(env, "order writes");
  napi_get_undefined(env, &result);
  return result;
}

EXPORT napi_value napi_register_module_v1(napi_env env, napi_value exports) {
#ifdef _WIN32
#define LOAD(name) name = (void *)GetProcAddress(GetModuleHandleW(NULL), #name); if (name == NULL) return NULL
  LOAD(napi_get_cb_info); LOAD(napi_get_value_string_utf8); LOAD(napi_get_value_bool);
  LOAD(napi_get_value_external); LOAD(napi_create_external); LOAD(napi_get_null);
  LOAD(napi_get_undefined); LOAD(napi_throw_error); LOAD(napi_create_function); LOAD(napi_set_named_property);
#undef LOAD
#endif
  const char *names[] = {"tryLock", "release", "flush", "replace", "order"};
  napi_callback callbacks[] = {acquire, release, flush, replace, order};
  for (size_t index = 0; index < 5; index++) {
    napi_value function;
    if (napi_create_function(env, names[index], strlen(names[index]), callbacks[index], NULL, &function) != 0) return NULL;
    if (napi_set_named_property(env, exports, names[index], function) != 0) return NULL;
  }
  return exports;
}
