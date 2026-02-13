export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  // AgentChat moved to MainTab
  StrategyApproval: undefined;
  AgentChat: { fromStrategyApproval?: boolean }; // Allow direct navigation to Chat with params
};

export type DrawerParamList = {
  AgentChat: { fromStrategyApproval?: boolean };
  Dashboard: undefined;
  CampaignList: undefined;
  Settings: undefined;
};

export type MainTabParamList = {
  AgentChat: { fromStrategyApproval?: boolean }; // New Home
  Dashboard: undefined;
  CampaignList: undefined;
  StrategyHistory: undefined;
<<<<<<< HEAD
=======
  Wallet: undefined;
>>>>>>> adroom-mobile
  Settings: undefined;
};
