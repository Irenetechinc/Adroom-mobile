module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Backend contract tests are compiled and run by backend/npm run test:contracts.
  // Keeping them out of the Expo project prevents Jest from treating the
  // assertion-only contract file as an empty test suite.
  testPathIgnorePatterns: ['/node_modules/', '/backend/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind)',
  ],
};
