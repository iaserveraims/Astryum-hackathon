export interface MCPServerCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: 'crypto_data' | 'productivity' | 'blockchain';
  requiresApiKey: boolean;
  apiKeyLabel?: string;        // label shown in UI for the key field
  serverUrl?: string;          // default URL if applicable
  docsUrl?: string;
  tools: string[];             // tools this server exposes (informational)
}

export const MCP_CATALOG: MCPServerCatalogEntry[] = [
  // ─── CRYPTO DATA ────────────────────────────────────────────────────────────
  {
    id: 'coinglass',
    name: 'CoinGlass',
    description: 'Funding rates, open interest, liquidations, long/short ratios, Fear & Greed index',
    category: 'crypto_data',
    requiresApiKey: true,
    apiKeyLabel: 'CoinGlass API Key',
    docsUrl: 'https://www.coinglass.com/account',
    tools: ['get_funding_rates', 'get_open_interest', 'get_liquidations', 'get_fear_greed', 'get_long_short_ratio'],
  },
  {
    id: 'santiment',
    name: 'Santiment',
    description: 'Sentiment analysis, social metrics, on-chain signals, trending topics',
    category: 'crypto_data',
    requiresApiKey: true,
    apiKeyLabel: 'Santiment API Key',
    docsUrl: 'https://app.santiment.net/',
    tools: ['get_social_sentiment', 'get_on_chain_signals', 'get_trending_topics', 'get_whale_activity'],
  },
  {
    id: 'tradingview',
    name: 'TradingView',
    description: 'Technical indicators (RSI, MACD, Bollinger Bands) for any trading pair',
    category: 'crypto_data',
    requiresApiKey: false,
    docsUrl: 'https://www.tradingview.com/',
    tools: ['get_technical_analysis', 'get_chart_data', 'get_indicators'],
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    description: 'Prices, market cap, volume, trending coins — free tier available',
    category: 'crypto_data',
    requiresApiKey: false,
    docsUrl: 'https://www.coingecko.com/en/api',
    tools: ['get_price', 'get_market_data', 'get_trending_coins', 'get_coin_detail'],
  },
  {
    id: 'messari',
    name: 'Messari',
    description: 'Research reports, fundamentals, on-chain metrics',
    category: 'crypto_data',
    requiresApiKey: true,
    apiKeyLabel: 'Messari API Key',
    docsUrl: 'https://messari.io/api',
    tools: ['get_asset_metrics', 'get_research_reports', 'get_protocol_data'],
  },
  {
    id: 'nansen',
    name: 'Nansen',
    description: 'Smart money tracking, wallet labels, DeFi analytics',
    category: 'crypto_data',
    requiresApiKey: true,
    apiKeyLabel: 'Nansen API Key',
    docsUrl: 'https://www.nansen.ai/',
    tools: ['get_smart_money_flows', 'get_wallet_labels', 'get_defi_analytics'],
  },
  {
    id: 'dune',
    name: 'Dune Analytics',
    description: 'Custom on-chain queries and dashboards',
    category: 'crypto_data',
    requiresApiKey: true,
    apiKeyLabel: 'Dune API Key',
    docsUrl: 'https://dune.com/docs/api/',
    tools: ['execute_query', 'get_query_result', 'get_dashboard'],
  },

  // ─── PRODUCTIVITY ────────────────────────────────────────────────────────────
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Access documents and spreadsheets from Google Drive',
    category: 'productivity',
    requiresApiKey: true,
    apiKeyLabel: 'Google OAuth Token',
    tools: ['search_files', 'read_file', 'list_folder'],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read emails — useful for DeFi alerts from protocols',
    category: 'productivity',
    requiresApiKey: true,
    apiKeyLabel: 'Google OAuth Token',
    tools: ['list_emails', 'read_email', 'search_emails'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Notes, wikis, and databases from Notion',
    category: 'productivity',
    requiresApiKey: true,
    apiKeyLabel: 'Notion Integration Token',
    docsUrl: 'https://www.notion.so/my-integrations',
    tools: ['search_pages', 'read_page', 'query_database'],
  },
  {
    id: 'brave_search',
    name: 'Brave Search',
    description: 'Real-time web search for news and protocol updates',
    category: 'productivity',
    requiresApiKey: true,
    apiKeyLabel: 'Brave Search API Key',
    docsUrl: 'https://api.search.brave.com/',
    tools: ['web_search', 'news_search'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send notifications to Slack channels',
    category: 'productivity',
    requiresApiKey: true,
    apiKeyLabel: 'Slack Bot Token',
    tools: ['send_message', 'list_channels', 'read_messages'],
  },

  // ─── BLOCKCHAIN ──────────────────────────────────────────────────────────────
  {
    id: 'alchemy',
    name: 'Alchemy',
    description: 'On-chain data: NFTs, token balances, transactions across 80+ chains',
    category: 'blockchain',
    requiresApiKey: true,
    apiKeyLabel: 'Alchemy API Key',
    docsUrl: 'https://www.alchemy.com/',
    tools: ['get_token_balances', 'get_nfts', 'get_transactions', 'get_block'],
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    description: 'Transaction history, contract verification, event logs',
    category: 'blockchain',
    requiresApiKey: true,
    apiKeyLabel: 'Etherscan API Key',
    docsUrl: 'https://docs.etherscan.io/',
    tools: ['get_transactions', 'get_contract_abi', 'get_logs', 'get_token_transfers'],
  },
];

export function getCatalogEntry(serverId: string): MCPServerCatalogEntry | undefined {
  return MCP_CATALOG.find((s) => s.id === serverId);
}
