import { requireAdminSession } from '@/lib/admin-session';
import { getExpenseDashboardData } from '@/actions/expense-actions';
import ExpenseManager from '@/components/admin/expenses/ExpenseManager';

export const metadata = {
  title: 'Expense Manager | Admin | 1Think 2Win',
  description: 'Manage project subscriptions, upcoming charges, and billing cycle deductions.',
};

export default async function AdminExpensesPage() {
  // Validate admin authorization; redirects to /admin/login if unauthorized
  await requireAdminSession();

  const data = await getExpenseDashboardData();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <ExpenseManager
          initialSummary={data.summary}
          initialGroupedExpenses={data.groupedExpenses}
          initialSubscriptions={data.subscriptions}
          initialExpenses={data.expenses}
          initialSettings={data.settings}
        />
      </div>
    </div>
  );
}

