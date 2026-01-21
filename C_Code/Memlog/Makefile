# Compilers
HOST_GCC   := g++
TARGET_GCC := gcc

# Sources
PLUGIN_SRC  := memlog_plugin.cc
RUNTIME_SRC := memlog_runtime.c
TARGET_SRC  := plugin_example.c

# GCC plugin include dir
GCC_PLUGINS_DIR := $(shell $(TARGET_GCC) -print-file-name=plugin)
PLUGIN_INC      := $(GCC_PLUGINS_DIR)/include

# Flags
CXXFLAGS += -I$(PLUGIN_INC) -fPIC -fno-rtti -fno-exceptions -std=gnu++17
LDFLAGS_PLUGIN := -shared
CFLAGS  += -g -O0

.PHONY: all clean test run static_demo runtime_demo

all: memlog_plugin.so memlog_runtime.o

# Build the plugin shared object
memlog_plugin.so: $(PLUGIN_SRC)
	$(HOST_GCC) $(LDFLAGS_PLUGIN) $(CXXFLAGS) $< -o $@

# Build runtime object (optional, for later runtime mode)
memlog_runtime.o: $(RUNTIME_SRC)
	$(TARGET_GCC) -c $(CFLAGS) $< -o $@

# -----------------------
# STATIC DEMO (safe): plugin logs JSONL only; no runtime.o
# -----------------------
static_demo: memlog_plugin.so
	mkdir -p out
	$(TARGET_GCC) $(CFLAGS) \
	  -fplugin=$(CURDIR)/memlog_plugin.so \
	  -fplugin-arg-memlog_plugin-out=$(CURDIR)/out/sites.jsonl \
	  $(TARGET_SRC) -o a_static.out

# -----------------------
# RUNTIME DEMO (optional): old behavior would require a different plugin
# (your new plugin no longer injects runtime hooks)
# Keep this target for the future or remove it.
# -----------------------
runtime_demo: memlog_plugin.so memlog_runtime.o
	@echo "NOTE: runtime_demo requires a runtime-instrumenting plugin version."
	@echo "Your current memlog_plugin.cc is static-only. Re-enable injection to use this."

clean:
	rm -f memlog_plugin.so memlog_runtime.o a_static.out
	rm -rf out
