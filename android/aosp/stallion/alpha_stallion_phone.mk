# Alpha on the Eliza AOSP baseline. The matching stallion vendor tree and
# factory kernel must be generated and verified before this product is built.
USE_STOCK_KERNEL := true
$(call inherit-product, vendor/google_devices/stallion/stallion.mk)
$(call inherit-product, vendor/alphaphone/product.mk)

PRODUCT_NAME := alpha_stallion_phone
PRODUCT_DEVICE := stallion
PRODUCT_MODEL := Alpha Phone Pixel 10a
PRODUCT_BRAND := Alpha
PRODUCT_MANUFACTURER := Google

# Preserve the fallback HOME app and provisioning during hardware bring-up.
# Alpha carries the Eliza runtime in its own nonprivileged, presigned APK.
