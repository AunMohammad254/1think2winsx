import ForgotPasswordForm from './ForgotPasswordForm';

export default async function ForgotPasswordPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const params = await searchParams;
    return <ForgotPasswordForm linkExpired={params.error === 'link_expired'} />;
}
