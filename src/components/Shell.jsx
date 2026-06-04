import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Sidebar from './Sidebar.jsx';
import PhoneBar from './PhoneBar.jsx';
import NotificationBell from './NotificationBell.jsx';
import AccountPanel from './AccountPanel.jsx';
import Board from './Board.jsx';
import UsersPanel from './UsersPanel.jsx';
import FeaturesPanel from './FeaturesPanel.jsx';
import ItemDetail from './ItemDetail.jsx';
import CompanyList from './crm/CompanyList.jsx';
import CompanyDetail from './crm/CompanyDetail.jsx';
import ContactList from './crm/ContactList.jsx';
import ContactDetail from './crm/ContactDetail.jsx';
import LocationList from './crm/LocationList.jsx';
import LocationDetail from './crm/LocationDetail.jsx';
import TaskList from './crm/TaskList.jsx';
import TaskDetail from './crm/TaskDetail.jsx';
import ProjectList from './crm/ProjectList.jsx';
import ProjectDetail from './crm/ProjectDetail.jsx';
import LeadBoard from './crm/LeadBoard.jsx';
import DealBoard from './crm/DealBoard.jsx';
import DealDetail from './crm/DealDetail.jsx';
import OnboardingBoard from './crm/OnboardingBoard.jsx';
import OnboardingDetail from './crm/OnboardingDetail.jsx';
import TicketList from './crm/TicketList.jsx';
import TicketDetail from './crm/TicketDetail.jsx';
import ModulesPanel from './crm/ModulesPanel.jsx';
import FeatureRequestList from './crm/FeatureRequestList.jsx';
import FeatureRequestDetail from './crm/FeatureRequestDetail.jsx';
import ReleaseList from './crm/ReleaseList.jsx';
import ReleaseDetail from './crm/ReleaseDetail.jsx';
import ReportingDashboard from './crm/ReportingDashboard.jsx';
import SettingsPanel from './crm/SettingsPanel.jsx';
import FormsList from './crm/FormsList.jsx';
import FormBuilder from './crm/FormBuilder.jsx';
import TemplatesPanel from './crm/TemplatesPanel.jsx';

export default function Shell({ session }) {
  const [profile, setProfile]   = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [view, setView]         = useState('board');
  const [openItem, setOpenItem] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const refreshProfile = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (data) setProfile(data);
  };

  useEffect(() => {
    refreshProfile();
  }, [session.user.id]);

  useEffect(() => {
    load();
    const ch = supabase.channel('backlog_projects')
      .on('postgres_changes', { event:'*', schema:'public', table:'backlog_projects' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const load = async () => {
    const { data } = await supabase.from('backlog_projects').select('*').eq('archived', false).order('created_at');
    setProjects(data || []);
    if (!activeProject && data?.length) setActiveProject(data[0]);
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch {
      await supabase.auth.signOut({ scope: 'local' });
    }
  };

  // Navigate to a CRM record detail view
  const navigateTo = (type, id) => {
    if (type === 'company') { setView('company_detail'); setDetailId(id); }
    else if (type === 'contact') { setView('contact_detail'); setDetailId(id); }
    else if (type === 'location') { setView('location_detail'); setDetailId(id); }
    else if (type === 'deal') { setView('deal_detail'); setDetailId(id); }
    else if (type === 'onboarding') { setView('onboarding_detail'); setDetailId(id); }
    else if (type === 'ticket') { setView('ticket_detail'); setDetailId(id); }
    else if (type === 'project') { setView('project_detail'); setDetailId(id); }
    else if (type === 'task') { setView('task_detail'); setDetailId(id); }
    else if (type === 'lead') { setView('leads'); } // no detail view; open the board
  };

  if (!profile) return <div className="h-full flex items-center justify-center text-muted text-sm">Loading profile...</div>;

  const renderMain = () => {
    switch (view) {
      case 'users':
        return <UsersPanel profile={profile} />;
      case 'features':
        return activeProject ? <FeaturesPanel project={activeProject} profile={profile} /> : null;
      case 'companies':
        return <CompanyList profile={profile} onSelect={(id) => navigateTo('company', id)} />;
      case 'company_detail':
        return <CompanyDetail companyId={detailId} profile={profile}
          onClose={() => setView('companies')} onNavigate={navigateTo} />;
      case 'contacts':
        return <ContactList profile={profile} onSelect={(id) => navigateTo('contact', id)} />;
      case 'contact_detail':
        return <ContactDetail contactId={detailId} profile={profile}
          onClose={() => setView('contacts')} onNavigate={navigateTo} />;
      case 'locations':
        return <LocationList profile={profile} onSelect={(id) => navigateTo('location', id)} onNavigate={navigateTo} />;
      case 'location_detail':
        return <LocationDetail locationId={detailId} profile={profile}
          onClose={() => setView('locations')} onNavigate={navigateTo} />;
      case 'leads':
        return <LeadBoard profile={profile} onNavigate={navigateTo} />;
      case 'deals':
        return <DealBoard profile={profile} onSelectDeal={(id) => { setView('deal_detail'); setDetailId(id); }} onNavigate={navigateTo} />;
      case 'deal_detail':
        return <DealDetail dealId={detailId} profile={profile} onClose={() => setView('deals')} onNavigate={navigateTo} />;
      case 'onboarding':
        return <OnboardingBoard profile={profile} onSelectOnboarding={(id) => { setView('onboarding_detail'); setDetailId(id); }} onNavigate={navigateTo} />;
      case 'onboarding_detail':
        return <OnboardingDetail onboardingId={detailId} profile={profile} onClose={() => setView('onboarding')} onNavigate={navigateTo} />;
      case 'tickets':
        return <TicketList profile={profile} onSelect={(id) => { setView('ticket_detail'); setDetailId(id); }} onNavigate={navigateTo} />;
      case 'ticket_detail':
        return <TicketDetail ticketId={detailId} profile={profile} onClose={() => setView('tickets')} onNavigate={navigateTo} />;
      case 'modules':
        return <ModulesPanel profile={profile} />;
      case 'feature_requests':
        return <FeatureRequestList profile={profile} onSelect={(id) => { setView('feature_request_detail'); setDetailId(id); }} />;
      case 'feature_request_detail':
        return <FeatureRequestDetail requestId={detailId} profile={profile} onClose={() => setView('feature_requests')} onNavigate={navigateTo} />;
      case 'releases':
        return <ReleaseList profile={profile} onSelect={(id) => { setView('release_detail'); setDetailId(id); }} />;
      case 'release_detail':
        return <ReleaseDetail releaseId={detailId} profile={profile} onClose={() => setView('releases')} />;
      case 'reporting':
        return <ReportingDashboard profile={profile} />;
      case 'settings':
        return <SettingsPanel profile={profile} />;
      case 'account':
        return <AccountPanel profile={profile} onSaved={refreshProfile} />;
      case 'templates':
        return <TemplatesPanel profile={profile} />;
      case 'forms':
        return <FormsList profile={profile} onSelect={(id) => { setView('form_detail'); setDetailId(id); }} />;
      case 'form_detail':
        return <FormBuilder formId={detailId} profile={profile} onClose={() => setView('forms')} onNavigate={navigateTo} />;
      case 'tasks':
        return <TaskList profile={profile} onSelect={(id) => { setView('task_detail'); setDetailId(id); }} />;
      case 'task_detail':
        return <TaskDetail taskId={detailId} profile={profile} onClose={() => setView('tasks')} onNavigate={navigateTo} />;
      case 'projects':
        return <ProjectList profile={profile} onSelect={(id) => { setView('project_detail'); setDetailId(id); }} />;
      case 'project_detail':
        return <ProjectDetail projectId={detailId} profile={profile}
          onClose={() => setView('projects')}
          onSelectTask={(id) => { setView('task_detail'); setDetailId(id); }}
          onNavigate={navigateTo} />;
      case 'board':
      default:
        return activeProject
          ? <Board project={activeProject} profile={profile} onOpenItem={setOpenItem} />
          : <div className="h-full flex items-center justify-center text-muted text-sm">No projects yet. Create one from the sidebar.</div>;
    }
  };

  return (
    <div className="h-full flex">
      <Sidebar
        profile={profile}
        projects={projects}
        activeProject={activeProject}
        setActiveProject={(p) => { setActiveProject(p); setView('board'); }}
        view={view}
        setView={setView}
        onSignOut={signOut}
        onRefresh={load}
      />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="flex items-stretch border-b border-bdr">
        <div className="flex-1 min-w-0"><PhoneBar profile={profile} /></div>
        <div className="glass flex items-center px-3 shrink-0">
          <NotificationBell profile={profile} onNavigate={navigateTo} />
        </div>
      </div>
      <main className="flex-1 min-w-0 overflow-hidden">
        {renderMain()}
      </main>
      </div>
      {openItem && (
        <ItemDetail
          itemId={openItem}
          profile={profile}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  );
}
