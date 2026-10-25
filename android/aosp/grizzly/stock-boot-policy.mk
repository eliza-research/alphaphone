# Alpha's B1 stock-kernel development profile. Append after the hash-verified
# generated BoardConfig; never edit the pinned adevtool checkout.
# This does not claim GrapheneOS hardening or working MTE on Pixel 11 firmware.
ifeq ($(TARGET_PRODUCT),alpha_grizzly_phone)
ifneq ($(USE_STOCK_KERNEL),true)
$(error Alpha B1 boot policy requires USE_STOCK_KERNEL=true)
endif

# Match B1's explicit KASAN and allocation-initialization settings. The AOSP
# board loader adds bootconfig once when BOARD_BOOTCONFIG is present.
BOARD_KERNEL_CMDLINE := $(filter-out bootloader.pixel.MTE_FORCE_ON kasan.fault=% kasan=% init_on_alloc=% init_on_free=% bootconfig,$(BOARD_KERNEL_CMDLINE)) kasan=off init_on_alloc=0 init_on_free=1

# Do not inherit the generic armv9 board's global heap-tagging opt-in while
# firmware MTE is unqualified. This is a build policy, not a hardware claim.
SANITIZE_TARGET := $(filter-out memtag_heap memtag_stack memtag_globals,$(SANITIZE_TARGET))
TARGET_HAS_ARM_MTE := false
endif
