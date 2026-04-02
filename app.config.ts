import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: config.name || "AdRoom",
    slug: config.slug || "adroom-mobile",
    extra: {
      ...config.extra,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
      facebookAppId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
      eas: {
        projectId: "3b1fdc27-8b2b-4661-9f92-072a73d5425e"
      }
    },
  };
};
