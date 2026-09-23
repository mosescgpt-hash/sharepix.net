import UseCaseLanding from '@/components/UseCaseLanding';
import { useCaseBySlug } from '@/lib/useCases';

const useCase = useCaseBySlug('graduation-parties')!;

export default function GraduationPartiesLandingPage() {
  return <UseCaseLanding useCase={useCase} />;
}
