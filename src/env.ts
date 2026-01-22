export const ENV = {
  get OPENROUTER_API_KEY() {
    return process.env.OPENROUTER_API_KEY;
  },
  get OPENROUTER_PROVISIONING_KEY() {
    return process.env.OPENROUTER_PROVISIONING_KEY;
  },
  get OPENROUTER_MODEL() {
    return process.env.OPENROUTER_MODEL;
  },
  get EIKON_TIMEOUT_MS() {
    const val = process.env.EIKON_TIMEOUT_MS;
    return val ? parseInt(val, 10) : undefined;
  },
  get NO_COLOR() {
    return process.env.NO_COLOR !== undefined;
  },
  get EIKON_MOCK_OPENROUTER() {
    return process.env.EIKON_MOCK_OPENROUTER === "1";
  },
  get EIKON_TEST_IMAGE_INFO() {
    return process.env.EIKON_TEST_IMAGE_INFO === "1";
  },
};
