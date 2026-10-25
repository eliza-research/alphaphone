PRODUCT_MAKEFILES := $(LOCAL_DIR)/alpha_stallion_phone.mk

# cp2a is the existing Eliza/Alpha AOSP baseline. Vendor API compatibility must
# be checked against the generated stallion VINTF manifest before an image is
# admitted for installation. A successful lunch is not that qualification.
COMMON_LUNCH_CHOICES := alpha_stallion_phone-cp2a-userdebug
