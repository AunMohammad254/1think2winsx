import { getDb, getAdminDb, fetchAllByKeyset } from './shared';

export interface NewsletterSubscription {
  id: string;
  email: string;
  createdAt: string;
}

export const newsletterDb = {
  /**
   * Subscribe an email to the newsletter.
   * `isNew` is true only when this call created the subscription (not for repeat sign-ups),
   * so callers can send a one-time confirmation email.
   */
  async subscribeEmail(email: string): Promise<{ success: boolean; message: string; isNew?: boolean; error?: string }> {
    try {
      const db = await getDb();

      // Try inserting the email
      const { error } = await db
        .from('NewsletterSubscription')
        .insert([{ email }]);

      if (error) {
        // Handle duplicate key violation (23505)
        if (error.code === '23505') {
          return { success: true, isNew: false, message: 'You are already subscribed!' };
        }
        throw error;
      }

      return { success: true, isNew: true, message: 'Subscribed successfully!' };
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
      // Every page, in primary-key order. A bare select() is silently capped at PostgREST's
      // 1,000-row limit, so a newsletter used to reach at most the first thousand subscribers
      // while the admin screen reported success.
      const rows = await fetchAllByKeyset<{ id: string; email: string }>(
        (after, limit) => {
          let q = adminDb.from('NewsletterSubscription').select('id, email');
          if (after) q = q.gt('id', after);
          return q.order('id', { ascending: true }).limit(limit);
        },
        (row) => row.id,
      );
      return rows.map((sub) => sub.email);
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
