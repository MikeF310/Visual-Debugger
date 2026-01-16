// memlog_runtime.c
#define _GNU_SOURCE
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>


static FILE *g_out;

__attribute__((constructor))
static void memlog_init(void) {
  const char *path = getenv("MEMLOG_OUT");
  if (path && path[0]) {
    g_out = fopen(path, "w");
    if (!g_out) g_out = stderr;
  } else {
    g_out = stderr;
  }
  setvbuf(g_out, NULL, _IOLBF, 0);
}

__attribute__((destructor))
static void memlog_fini(void) {
  if (g_out && g_out != stderr) fclose(g_out);
}

static void hex_bytes(FILE *f, const unsigned char *p, size_t n) {
  for (size_t i = 0; i < n; i++) fprintf(f, "%02x", p[i]);
}

// Alloc event: ptr returned by malloc/calloc/realloc, size expression value
void __memlog_alloc(uint32_t site, const void *ptr, size_t nbytes) {
  fprintf(g_out,
          "{\"kind\":\"alloc\",\"site\":%u,\"ptr\":\"%p\",\"n\":%zu} \n",
          site, ptr, nbytes);
}

// Store event: address written, size, and bytes written
void __memlog_store(uint32_t site, const void *addr, size_t nbytes, const void *bytes) {
  fprintf(g_out,
          "{\"kind\":\"store\",\"site\":%u,\"addr\":\"%p\",\"n\":%zu,\"bytes\":\"",
          site, addr, nbytes);
  hex_bytes(g_out, (const unsigned char*)bytes, nbytes);
  fprintf(g_out, "\"}\n");
}

// Optional: local variable metadata (you can call this at startup, or skip)
void __memlog_local(uint32_t site, const char *name, size_t size) {
  fprintf(g_out,
          "{\"kind\":\"local\",\"site\":%u,\"name\":\"%s\",\"size\":%zu}\n",
          site, name ? name : "?", size);
}