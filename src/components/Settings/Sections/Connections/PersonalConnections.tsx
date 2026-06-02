import { ConfigModelProvider, ModelProviderUISection } from '@/lib/config/types';
import ConnectionsList from './ConnectionsList';

// Personal Connections panel. Visible to every authenticated user; lists
// only rows the caller owns (scope=personal, userId=current user). Adding
// new connections still happens through the existing Add Connection button
// in the Models panel; the empty state nudges the user back there rather
// than duplicating that flow here.
const PersonalConnections = ({
  fields,
  onNavigate,
}: {
  fields: ModelProviderUISection[];
  values: ConfigModelProvider[];
  onNavigate?: (key: string) => void;
}) => {
  return (
    <ConnectionsList
      scope="personal"
      fields={fields}
      emptyState={
        <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border-2 border-dashed border-light-200 dark:border-dark-200 bg-light-secondary/10 dark:bg-dark-secondary/10">
          <p className="text-sm font-medium text-black/70 dark:text-white/70 mb-1">
            No personal connections yet
          </p>
          <p className="text-xs text-black/50 dark:text-white/50 text-center max-w-sm mb-4">
            You haven&apos;t added any personal connections yet. Use Add
            Connection in the Models panel to get started.
          </p>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('models')}
              className="px-3 py-1.5 rounded-lg text-xs border border-light-200 dark:border-dark-200 text-black dark:text-white bg-light-secondary/50 dark:bg-dark-secondary/50 hover:bg-light-secondary hover:dark:bg-dark-secondary hover:border-light-300 hover:dark:border-dark-300 active:scale-95 transition duration-200"
            >
              Open Models settings
            </button>
          )}
        </div>
      }
    />
  );
};

export default PersonalConnections;
