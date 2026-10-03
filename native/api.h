#ifndef LANGONROCK_NAPI_H
#define LANGONROCK_NAPI_H
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
typedef void (*napi_finalize)(napi_env, void *, void *);
#ifdef _WIN32
#include <windows.h>
#define API(name, args) static int (*name) args
#define EXPORT __declspec(dllexport)
#else
#define API(name, args) extern int name args
#define EXPORT __attribute__((visibility("default")))
#endif
API(napi_get_cb_info, (napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **));
API(napi_get_value_string_utf8, (napi_env, napi_value, char *, size_t, size_t *));
API(napi_get_value_bool, (napi_env, napi_value, bool *));
API(napi_get_value_external, (napi_env, napi_value, void **));
API(napi_create_external, (napi_env, void *, napi_finalize, void *, napi_value *));
API(napi_get_null, (napi_env, napi_value *));
API(napi_get_undefined, (napi_env, napi_value *));
API(napi_throw_error, (napi_env, const char *, const char *));
API(napi_create_function, (napi_env, const char *, size_t, napi_callback, void *, napi_value *));
API(napi_set_named_property, (napi_env, napi_value, const char *, napi_value));
#endif
