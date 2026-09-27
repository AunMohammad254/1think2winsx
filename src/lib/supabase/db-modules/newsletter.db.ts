import { getDb, getAdminDb } from './shared';

export interface NewsletterSubscription {
  id: string;
  email: string;
  createdAt: string;
}

export const newsletterDb = {
  /**
   * Subscribe an email to the newsletter
   */
  async subscribeEmail(email: string): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      const db = await getDb();
      
      // Try inserting the email
      const { error } = await db
        .from('NewsletterSubscription')
        .insert([{ email }]);

      if (error) {
        // Handle duplicate key violation (23505)
        if (error.code === '23505') {
          return { success: true, message: 'You are already subscribed!' };
        }
        throw error;
      }

      return { success: true, message: 'Subscribed successfully!' };
    } catch (error: any) {
      console.error('Error subscribing email:', error);
      return { success: false, message: 'Failed to subscribe', error: error.message };
    }
  },

  /**
   * Get all newsletter subscribers (Admin only)
   */
  async getSubscribers(): Promise<string[]> {
    try {
      const adminDb = getAdminDb();
      const { data, error } = await adminDb
        .from('NewsletterSubscription')
        .select('email');

      if (error) throw error;
      return (data || []).map((sub: { email: string }) => sub.email);
    } catch (error) {
      console.error('Error fetching subscribers:', error);
      return [];
    }
  },

  /**
   * Unsubscribe an email from the newsletter
   */
  async unsubscribeEmail(email: string): Promise<boolean> {
    try {
      const adminDb = getAdminDb();
      const { error } = await adminDb
        .from('NewsletterSubscription')
        .delete()
        .eq('email', email);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error unsubscribing email:', error);
      return false;
    }
  }
};
