export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  // AgentChat moved to MainTab
  StrategyApproval: undefined;
  AgentChat: { fromStrategyApproval?: boolean }; // Allow direct navigation to Chat with params
};

export type MainTabParamList = {
  AgentChat: { fromStrategyApproval?: boolean }; // New Home
  Dashboard: undefined;
  CampaignList: undefined;
  Settings: undefined;
};
