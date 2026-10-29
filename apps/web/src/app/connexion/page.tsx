import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/features/auth/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('submit'), robots: { index: false } };
}

export default function LoginPage() {
  return <LoginForm />;
}
