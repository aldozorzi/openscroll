import type { Metadata } from 'next';
import { SavedPageClient } from './SavedPageClient';

export const metadata: Metadata = {
  title: 'Salvati',
};

export default function SavedPage() {
  return <SavedPageClient />;
}