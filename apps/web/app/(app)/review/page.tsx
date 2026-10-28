import type { Metadata } from 'next';
import { ReviewPageClient } from './ReviewPageClient';

export const metadata: Metadata = {
  title: 'Ripasso',
};

export default function ReviewPage() {
  return <ReviewPageClient />;
}