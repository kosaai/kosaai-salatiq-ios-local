const { withInfoPlist, withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withSalatiqIOS(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.CFBundleDisplayName = 'صلاتك';
    mod.modResults.NSCameraUsageDescription = 'نحتاج إلى الكاميرا الأمامية لمتابعة وضعيات الصلاة محليًا على جهازك دون إرسال الصور.';
    delete mod.modResults.NSMicrophoneUsageDescription;
    delete mod.modResults.UIBackgroundModes;
    mod.modResults.UISupportedInterfaceOrientations = ['UIInterfaceOrientationPortrait'];
    return mod;
  });
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults = {};
    return mod;
  });
};
