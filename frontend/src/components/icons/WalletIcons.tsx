import React from 'react';

interface WalletIconProps {
  className?: string;
  size?: number;
}

// MetaMask Fox Logo
export const MetaMaskIcon: React.FC<WalletIconProps> = ({ className, size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 318 318"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clipPath="url(#clip0)">
      <circle cx="159" cy="159" r="159" fill="#f6851b"/>
      <path d="M259.8 80.4L179.4 145.2L192.6 115.2L259.8 80.4Z" fill="#e17726"/>
      <path d="M58.5 80.4L125.7 115.2L139.2 145.2L58.5 80.4Z" fill="#e17726"/>
      <path d="M221.4 207.6L200.4 241.8L252.9 256.2L267.6 207.9L221.4 207.6Z" fill="#e17726"/>
      <path d="M50.7 207.9L65.4 256.2L117.9 241.8L96.9 207.6L50.7 207.9Z" fill="#e17726"/>
      <path d="M115.8 127.8L103.2 146.1L155.1 148.5L153.6 94.2L115.8 127.8Z" fill="#e17726"/>
      <path d="M202.5 127.8L164.4 93.9L162.9 148.5L214.8 146.1L202.5 127.8Z" fill="#e17726"/>
      <path d="M117.9 241.8L143.7 229.2L121.8 208.2L117.9 241.8Z" fill="#e17726"/>
      <path d="M174.6 229.2L200.4 241.8L196.5 208.2L174.6 229.2Z" fill="#e17726"/>
      <path d="M200.4 241.8L174.6 229.2L176.4 244.5L176.1 255.9L200.4 241.8Z" fill="#d5bfb2"/>
      <path d="M117.9 241.8L142.2 255.9L141.9 244.5L143.7 229.2L117.9 241.8Z" fill="#d5bfb2"/>
      <path d="M142.5 195.6L121.2 189.3L134.7 182.7L142.5 195.6Z" fill="#233447"/>
      <path d="M175.8 195.6L183.6 182.7L197.1 189.3L175.8 195.6Z" fill="#233447"/>
      <path d="M117.9 241.8L122.1 207.6L96.9 207.9L117.9 241.8Z" fill="#cc6228"/>
      <path d="M196.2 207.6L200.4 241.8L221.4 207.9L196.2 207.6Z" fill="#cc6228"/>
      <path d="M214.8 146.1L162.9 148.5L175.8 195.6L183.6 182.7L197.1 189.3L214.8 146.1Z" fill="#cc6228"/>
      <path d="M121.2 189.3L134.7 182.7L142.5 195.6L155.1 148.5L103.2 146.1L121.2 189.3Z" fill="#cc6228"/>
      <path d="M103.2 146.1L121.8 208.2L121.2 189.3L103.2 146.1Z" fill="#e17726"/>
      <path d="M197.1 189.3L196.5 208.2L214.8 146.1L197.1 189.3Z" fill="#e17726"/>
      <path d="M155.1 148.5L142.5 195.6L156.9 224.7L160.2 185.7L155.1 148.5Z" fill="#e17726"/>
      <path d="M162.9 148.5L157.8 185.4L161.1 224.7L175.8 195.6L162.9 148.5Z" fill="#e17726"/>
      <path d="M175.8 195.6L161.1 224.7L174.6 229.2L196.5 208.2L197.1 189.3L175.8 195.6Z" fill="#f6851b"/>
      <path d="M121.2 189.3L121.8 208.2L143.7 229.2L156.9 224.7L142.5 195.6L121.2 189.3Z" fill="#f6851b"/>
    </g>
    <defs>
      <clipPath id="clip0">
        <rect width="318" height="318" fill="white"/>
      </clipPath>
    </defs>
  </svg>
);

// Xaman Logo (simplified version with blue gradient)
export const XamanIcon: React.FC<WalletIconProps> = ({ className, size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="50" cy="50" r="50" fill="url(#xaman-gradient)"/>
    <path
      d="M25 30 L50 50 L75 30 L75 45 L50 65 L25 45 Z"
      fill="white"
      fillOpacity="0.9"
    />
    <path
      d="M30 55 L50 75 L70 55 L70 65 L50 85 L30 65 Z"
      fill="white"
      fillOpacity="0.7"
    />
    <defs>
      <radialGradient id="xaman-gradient" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#4285f4"/>
        <stop offset="100%" stopColor="#1652f0"/>
      </radialGradient>
    </defs>
  </svg>
);

// Petra Wallet Logo (stylized P with gradient)
export const PetraIcon: React.FC<WalletIconProps> = ({ className, size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="50" cy="50" r="50" fill="url(#petra-gradient)"/>
    <path
      d="M30 20 L30 80 L40 80 L40 55 L55 55 C65 55 72 48 72 38 C72 28 65 20 55 20 L30 20 Z M40 30 L55 30 C58 30 62 32 62 38 C62 44 58 45 55 45 L40 45 L40 30 Z"
      fill="white"
      fillOpacity="0.95"
    />
    <defs>
      <linearGradient id="petra-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#00d4aa"/>
        <stop offset="100%" stopColor="#00a085"/>
      </linearGradient>
    </defs>
  </svg>
);

// Generic wallet icon for fallback
export const GenericWalletIcon: React.FC<WalletIconProps> = ({ className, size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M19 7h-1V6a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8a3 3 0 0 0-3-3zM5 5h10a1 1 0 0 1 1 1v1H5a1 1 0 0 1 0-2zm15 13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.83A3 3 0 0 0 5 9h14a1 1 0 0 1 1 1v8z"/>
    <circle cx="16" cy="13" r="1"/>
  </svg>
);

// Helper function to get the appropriate wallet icon
export const getWalletIcon = (walletType: string) => {
  switch (walletType) {
    case 'metamask':
      return MetaMaskIcon;
    case 'xaman':
      return XamanIcon;
    case 'petra':
      return PetraIcon;
    default:
      return GenericWalletIcon;
  }
};