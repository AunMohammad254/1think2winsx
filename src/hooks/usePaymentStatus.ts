import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface PaymentInfo {
  id: string;
  expiresAt: Date;
  timeRemaining: number;
}

interface PaymentStatus {
  hasAccess: boolean;
  payment: PaymentInfo | null;
  validUntil: Date | null;
  message: string;
  loading: boolean;
  error: string | null;
}

export function usePaymentStatus() {
  const { data: session, status } = useSession();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>({
    hasAccess: false,
    payment: null,
    validUntil: null,
    message: '',
    loading: true,
    error: null,
  });

  useEffect(() => {
    const checkPaymentStatus = async () => {
      if (status !== 'authenticated') {
        setPaymentStatus({
          hasAccess: false,
          payment: null,
          validUntil: null,
          message: 'Not authenticated',
          loading: false,
          error: null,
        });
        return;
      }

      try {
        const response = await fetch('/api/daily-payment');
        
        if (response.ok) {
          const data = await response.json();
          setPaymentStatus({
            hasAccess: data.hasAccess,
            payment: data.payment,
            validUntil: data.validUntil ? new Date(data.validUntil) : null,
            message: data.message,
            loading: false,
            error: null,
          });
        } else {
          setPaymentStatus({
            hasAccess: false,
            payment: null,
            validUntil: null,
            message: 'Failed to check payment status',
            loading: false,
            error: 'Failed to check payment status',
          });
        }
      } catch (error) {
        console.error('Error checking payment status:', error);
        setPaymentStatus({
          hasAccess: false,
          payment: null,
          validUntil: null,
          message: 'Error checking payment status',
          loading: false,
          error: 'Error checking payment status',
        });
      }
    };

    checkPaymentStatus();
  }, [status, session]);

  return paymentStatus;
}