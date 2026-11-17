import { Capacitor } from '@capacitor/core';

// Central API and Application configurations
// Set VITE_API_URL at build time (e.g. in Vercel env vars) to point at the deployed backend
export const PRODUCTION_API_URL = import.meta.env.VITE_API_URL || 'https://attendance-web-app-five.vercel.app';

// Automatically use localhost when running locally (web), and Vercel in production or Capacitor native
const isLocalhost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
export const API_BASE_URL = (isLocalhost && !Capacitor.isNativePlatform())
  ? 'http://localhost:5000'
  : PRODUCTION_API_URL;
