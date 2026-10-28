'use client';

import Link from 'next/link';
import { FeedDeck } from './feed-deck';
import { ReviewIcon } from './icons';
import { PageHeading } from './page-heading';
import { useLocale } from './providers';

export function ReviewView() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeading
        eyebrow={t('reviewEyebrow')}
        titleKey="reviewTitle"
        subtitleKey="reviewPageSubtitle"
        icon={ReviewIcon}
        action={
          <Link href="/feed" className="btn btn-secondary">
            {t('navFeed')}
          </Link>
        }
      />
      <div className="min-h-0 flex-1">
        <FeedDeck fixedMode="review" showHeader={false} />
      </div>
    </div>
  );
}
