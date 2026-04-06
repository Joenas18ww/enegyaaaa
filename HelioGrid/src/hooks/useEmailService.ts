import { useState, useCallback } from 'react';

// ============================================================================
// EMAIL SERVICE CONFIGURATION
// ============================================================================

const EMAIL_SERVICE_URL = 'http://localhost:5001'; // Flask email service URL

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AlertEmailData {
  faultType: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  systemAction: string;
  gridVoltage: string;
  solarPower: string;
  batterySOC: string;
  affectedLoad: string;
  timestamp: string;
  temperature: string;
}

// ✅ FIX: Updated EmailResponse to include emailStatus
interface EmailResponse {
  status: 'success' | 'error';
  message: string;
  emailStatus?: 'Sent' | 'Failed' | 'Queued';  // ← Added this
  recipients?: string[];
  timestamp?: string;
}

// ============================================================================
// EMAIL SERVICE HOOK
// ============================================================================
export function useEmailService() {
  const [isHealthy, setIsHealthy] = useState(false);
  
  /**
   * 🏥 CHECK EMAIL SERVICE HEALTH
   * Returns true if Flask email service is running
   */
  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${EMAIL_SERVICE_URL}/api/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        const healthy = data.status === 'healthy';
        setIsHealthy(healthy);
        return healthy;
      }
      
      setIsHealthy(false);
      return false;
    } catch (error) {
      console.error('❌ Email service health check failed:', error);
      setIsHealthy(false);
      return false;
    }
  }, []);
  
  /**
   * 📧 SEND ALERT EMAIL
   * Sends anomaly alert to configured recipients
   */
  const sendAlert = useCallback(async (data: AlertEmailData): Promise<EmailResponse> => {
    try {
      const response = await fetch(`${EMAIL_SERVICE_URL}/api/send-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to send email');
      }
      
      // ✅ Return with emailStatus
      return {
        ...result,
        emailStatus: 'Sent',  // Mark as sent on success
      };
    } catch (error) {
      console.error('❌ Failed to send alert email:', error);
      
      // ✅ Return failure status
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        emailStatus: 'Failed',  // Mark as failed on error
      };
    }
  }, []);
  
  /**
   * ✉️ SEND TEST EMAIL
   * Sends a test email to verify configuration
   */
  const sendTestEmail = useCallback(async (email: string): Promise<EmailResponse> => {
    try {
      const response = await fetch(`${EMAIL_SERVICE_URL}/api/test-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to send test email');
      }
      
      return {
        ...result,
        emailStatus: 'Sent',
      };
    } catch (error) {
      console.error('❌ Failed to send test email:', error);
      
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        emailStatus: 'Failed',
      };
    }
  }, []);
  
  /**
   * 📋 GET RECIPIENTS LIST
   * Retrieves configured email recipients
   */
  const getRecipients = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch(`${EMAIL_SERVICE_URL}/api/recipients`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error('Failed to get recipients');
      }
      
      return result.recipients || [];
    } catch (error) {
      console.error('❌ Failed to get recipients:', error);
      return [];
    }
  }, []);
  
  /**
   * 💾 UPDATE RECIPIENTS LIST
   * Updates the list of email recipients
   */
  const updateRecipients = useCallback(async (emails: string[]): Promise<EmailResponse> => {
    try {
      const response = await fetch(`${EMAIL_SERVICE_URL}/api/recipients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'Failed to update recipients');
      }
      
      return result;
    } catch (error) {
      console.error('❌ Failed to update recipients:', error);
      throw error;
    }
  }, []);
  
  return {
    isHealthy,
    checkHealth,
    sendAlert,
    sendTestEmail,
    getRecipients,
    updateRecipients,
  };
}