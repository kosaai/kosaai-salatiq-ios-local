Pod::Spec.new do |s|
  s.name = 'LocalClassification'
  s.version = '1.0.0'
  s.summary = 'Offline front-camera Salatiq Core ML classification'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Salatiq'
  s.homepage = 'https://github.com/kosaai/kosaai-salatiq-ios-local'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.swift_version = '5.0'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreML', 'UIKit', 'CoreVideo'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'SalatiqCoreML' => ['Resources/best.mlpackage'] }
end
