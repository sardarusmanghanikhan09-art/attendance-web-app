import { Capacitor } from '@capacitor/core';

// Central API and Application configurations
// Set VITE_API_URL at build time (e.g. in Vercel env vars) to point at the deployed backend
export const PRODUCTION_API_URL = import.meta.env.VITE_API_URL || 'https://attendance-web-app-eight.vercel.app';

// Automatically use localhost when running locally (web), and Vercel in production or Capacitor native
const isLocalhost = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const isNative = Capacitor.isNativePlatform();
// On the web the API is served from the same Vercel domain as the site, so use relative URLs.
// The Android app has no domain of its own, so it needs VITE_API_URL (your Vercel URL) at build time.
export const API_BASE_URL = isNative
  ? PRODUCTION_API_URL
  : (isLocalhost ? 'http://localhost:5000' : (import.meta.env.VITE_API_URL || window.location.origin));
