import UseCaseLanding from '@/components/UseCaseLanding';
import { useCaseBySlug } from '@/lib/useCases';

const useCase = useCaseBySlug('conventions')!;

export default function ConventionsLandingPage() {
  return <UseCaseLanding useCase={useCase} />;
}
