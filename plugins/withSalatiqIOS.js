const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withInfoPlist, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

module.exports = function withSalatiqIOS(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.CFBundleDisplayName = 'Salatiq';
    mod.modResults.CFBundleName = 'Salatiq';
    mod.modResults.NSCameraUsageDescription = 'نحتاج إلى الكاميرا الأمامية لمتابعة وضعيات الصلاة محليًا على جهازك دون إرسال الصور.';
    delete mod.modResults.NSMicrophoneUsageDescription;
    delete mod.modResults.UIBackgroundModes;
    mod.modResults.UISupportedInterfaceOrientations = ['UIInterfaceOrientationPortrait'];
    return mod;
  });
  config = withXcodeProject(config, async (mod) => {
    // Expo derives PRODUCT_NAME from the Arabic display name by default.
    // Keep the App ID registration name ASCII in every native configuration.
    const target = mod.modResults.getFirstTarget().firstTarget;
    for (const [, configuration] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(mod.modResults, target.buildConfigurationList)) {
      configuration.buildSettings.PRODUCT_NAME = '"Salatiq"';
      configuration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = '"com.kosaai.salatiq"';
    }
    target.productName = 'Salatiq';
    mod.modResults.pbxFileReferenceSection()[target.productReference].path = 'Salatiq.app';
    // Localize the Home Screen name without changing the base App ID name.
    const project = mod.modResults;
    const localizedPath = `${mod.modRequest.projectName}/ar.lproj/InfoPlist.strings`;
    const localizedFile = path.join(mod.modRequest.platformProjectRoot, localizedPath);
    await fs.promises.mkdir(path.dirname(localizedFile), { recursive: true });
    await fs.promises.writeFile(localizedFile, '"CFBundleDisplayName" = "صلاتك";\n');
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    const variant = project.findPBXVariantGroupKey({ name: 'InfoPlist.strings' })
      || project.addLocalizationVariantGroup('InfoPlist.strings').fileRef;
    const localizedResource = project.addResourceFile(localizedPath, { variantGroup: true }, variant);
    if (localizedResource) {
      project.pbxFileReferenceSection()[localizedResource.fileRef].name = 'ar';
      project.getPBXVariantGroupByKey(variant).children.find(({ value }) => value === localizedResource.fileRef).comment = 'ar';
    }
    project.addKnownRegion('ar');
    return mod;
  });
  return withEntitlementsPlist(config, (mod) => {
    mod.modResults = {};
    return mod;
  });
};
