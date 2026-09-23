import UseCaseLanding from '@/components/UseCaseLanding';
import { useCaseBySlug } from '@/lib/useCases';

const useCase = useCaseBySlug('weddings')!;

export default function WeddingsLandingPage() {
  return <UseCaseLanding useCase={useCase} />;
}
