#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef _WIN32
#define CF_EXPORT __declspec(dllexport)
#define CF_CALL __cdecl
#else
#define CF_EXPORT __attribute__((visibility("default")))
#define CF_CALL
#endif
#ifdef __cplusplus
extern "C" {
#endif
/* 0: manifest JSON, 1: userscript. UTF-8 bytes valid until DLL unload.
   Unknown kind: return NULL and write length 0. The host never frees the pointer. */
CF_EXPORT const uint8_t *CF_CALL cf_site_resource_v1(uint32_t kind, size_t *length);
#ifdef __cplusplus
}
#endif
