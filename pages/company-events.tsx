import UseCaseLanding from '@/components/UseCaseLanding';
import { useCaseBySlug } from '@/lib/useCases';

const useCase = useCaseBySlug('company-events')!;

export default function CompanyEventsLandingPage() {
  return <UseCaseLanding useCase={useCase} />;
}
