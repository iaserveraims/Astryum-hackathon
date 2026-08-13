// src/services/api.ts
"use client";

import { ApiResponse, ApiError } from '../types/api';
import { StepUpRequiredError } from './stepUpError';
import { stepUpBus, featureForEndpoint } from './stepUpBus';
import { useAuthStore } from '../stores/authStore';
import { getApiBase } from '../lib/env';

class ApiService {
  public baseURL: string;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.baseURL = getApiBase();
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  private getAuthToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('auth_token');
    }
    return null;
  }

  public getHeaders(stepUpGrant?: string): Record<string, string> {
    const headers = { ...this.defaultHeaders };
    const token = this.getAuthToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (stepUpGrant) {
      headers['X-StepUp-Grant'] = stepUpGrant;
    }

    return headers;
  }

  private handleUnauthorized(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('astryum-auth-storage');
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }

  // Resolve a cached step-up grant for this endpoint/method so retries (and the
  // first call after unlocking) carry the grant automatically.
  private resolveGrant(endpoint: string, method: string, explicit?: string): string | undefined {
    if (explicit) return explicit;
    const feature = featureForEndpoint(endpoint);
    if (!feature) return undefined;
    const action = method === 'GET' || method === 'HEAD' ? 'read' : 'write';
    try {
      return useAuthStore.getState().getValidGrant(feature, action) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      if (response.status === 401) this.handleUnauthorized();
      const errorData = await response.json().catch(() => ({}));
      // Step-up locks: surface a typed error so callers can run the signature
      // handshake and retry. Carries which feature/action was gated. Also emit
      // on the bus so the global host can prompt + refetch for plain reads.
      if (response.status === 403 && errorData.code === 'STEP_UP_REQUIRED') {
        stepUpBus.emit(errorData.feature, errorData.action);
        throw new StepUpRequiredError(errorData.feature, errorData.action);
      }
      const error: ApiError = {
        message: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
        status: response.status,
        code: errorData.code,
      };
      throw error;
    }

    const data = await response.json();
    return data.data || data;
  }

  async get<T>(endpoint: string, params?: Record<string, any>, stepUpGrant?: string): Promise<T> {
    const url = new URL(`${this.baseURL}${endpoint}`);

    if (params) {
      Object.keys(params).forEach(key =>
        url.searchParams.append(key, params[key])
      );
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders(this.resolveGrant(endpoint, 'GET', stepUpGrant)),
    });

    return this.handleResponse<T>(response);
  }

  async post<T>(endpoint: string, data?: any, stepUpGrant?: string): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers: this.getHeaders(this.resolveGrant(endpoint, 'POST', stepUpGrant)),
      body: data ? JSON.stringify(data) : null,
    });

    return this.handleResponse<T>(response);
  }

  async put<T>(endpoint: string, data?: any, stepUpGrant?: string): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'PUT',
      headers: this.getHeaders(this.resolveGrant(endpoint, 'PUT', stepUpGrant)),
      body: data ? JSON.stringify(data) : null,
    });

    return this.handleResponse<T>(response);
  }

  async patch<T>(endpoint: string, data?: any, stepUpGrant?: string): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'PATCH',
      headers: this.getHeaders(this.resolveGrant(endpoint, 'PATCH', stepUpGrant)),
      body: data ? JSON.stringify(data) : null,
    });

    return this.handleResponse<T>(response);
  }

  async delete<T>(endpoint: string, stepUpGrant?: string): Promise<T> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'DELETE',
      headers: this.getHeaders(this.resolveGrant(endpoint, 'DELETE', stepUpGrant)),
    });

    return this.handleResponse<T>(response);
  }

  async upload<T>(endpoint: string, file: File, additionalData?: Record<string, any>): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (additionalData) {
      Object.keys(additionalData).forEach(key => {
        formData.append(key, additionalData[key]);
      });
    }

    const headers = { ...this.getHeaders() };
    delete headers['Content-Type']; // Let browser set it for FormData

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    return this.handleResponse<T>(response);
  }
}

export const apiService = new ApiService();