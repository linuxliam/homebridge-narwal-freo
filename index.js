import { NarwalPlatform, PLATFORM_NAME } from './lib/platform.js';

export default (api) => {
  api.registerPlatform(PLATFORM_NAME, NarwalPlatform);
};
