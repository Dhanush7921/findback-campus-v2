import { EmptyBoxArt } from '../../components/art';
import { ButtonLink, EmptyState } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="safe-x mx-auto max-w-xl py-16">
      <EmptyState art={<EmptyBoxArt />} title={t('notFound.title')} text={t('notFound.text')} action={<ButtonLink to="/">{t('nav.home')}</ButtonLink>} />
    </div>
  );
}
