import { AlertCircle, Clock, CheckCircle2, RefreshCw } from 'lucide-react';
import type { ConnectionStatus } from '@/hooks';

interface ConnectionBannerProps {
  status: ConnectionStatus;
}

export default function ConnectionBanner({ status }: ConnectionBannerProps) {
  if (status === 'connected') {
    return null;
  }

  const config: Record<ConnectionStatus, { text: string; icon: React.ReactNode; alertType: string }> = {
    connected: { text: 'Connected', icon: <CheckCircle2 className="w-5 h-5" />, alertType: 'alert-success' },
    connecting: { text: 'Connecting...', icon: <Clock className="w-5 h-5 animate-spin" />, alertType: 'alert-info' },
    disconnected: { text: 'Disconnected', icon: <AlertCircle className="w-5 h-5" />, alertType: 'alert-error' },
    reconnecting: { text: 'Reconnecting...', icon: <RefreshCw className="w-5 h-5 animate-spin" />, alertType: 'alert-warning' },
  };

  const { text, icon, alertType } = config[status];

  const alertClasses =
    status === 'disconnected'
      ? 'alert-error'
      : status === 'reconnecting'
        ? 'alert-warning'
        : 'alert-info';

  return (
    <div role="status" aria-live="polite">
      <div className={`alert ${alertClasses} rounded-none`}>
        <div className="flex items-center gap-2 flex-1">
          {icon}
          <span>{text}</span>
        </div>
        {status === 'disconnected' && (
          <button className="btn btn-sm btn-ghost" onClick={() => window.location.reload()}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
