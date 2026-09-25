module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';

  return {
    ...config,
    name: config.name || 'Adirum AI',
    slug: config.slug || 'adroom-mobile',
    owner: 'iamwavelord',
    extra: {
      ...config.extra,
      eas: {
        ...config.extra?.eas,
        projectId: '3b1fdc27-8b2b-4661-9f92-072a73d5425e',
      },
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      facebookAppId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
    },
    android: {
      ...config.android,
      googleServicesFile,
    },
  };
};
