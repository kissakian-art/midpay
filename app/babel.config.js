module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 57) auto-configures the react-native-worklets /
    // reanimated Babel plugin when those packages are installed. Do NOT add
    // 'react-native-worklets/plugin' manually here — it would be applied twice
    // and break worklet compilation.
    presets: ["babel-preset-expo"],
  };
};
