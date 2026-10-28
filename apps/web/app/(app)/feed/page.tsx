import type { Metadata } from 'next';
import { FeedPageClient } from './FeedPageClient';

export const metadata: Metadata = {
  title: 'Feed',
};

export default function FeedPage() {
  return <FeedPageClient />;
}