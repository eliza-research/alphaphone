# Alpha development product. Generated vendor inputs must satisfy the reviewed
# Pixel 11 Pro source/firmware contract before building. This is not a flasher.
USE_STOCK_KERNEL := true
$(call inherit-product, vendor/google_devices/grizzly/grizzly.mk)
$(call inherit-product, vendor/alphaphone/product.mk)

PRODUCT_NAME := alpha_grizzly_phone
PRODUCT_DEVICE := grizzly
PRODUCT_MODEL := Alpha Phone Pixel 11 Pro
PRODUCT_BRAND := Alpha
PRODUCT_MANUFACTURER := Google

# Keep AOSP HOME alternatives and provisioning available for bring-up recovery.
# Alpha is a nonprivileged, separately signed app; do not inherit Eliza's common
# product, permission grants, role overrides or SELinux policy.
