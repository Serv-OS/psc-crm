import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import Sidebar from './Sidebar.jsx';
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
import DealBoard from './crm/DealBoard.jsx';
import DealDetail from './crm/DealDetail.jsx';
import OnboardingBoard from './crm/OnboardingBoard.jsx';
import OnboardingDetail from './crm/OnboardingDetail.jsx';
import TicketList from './crm/TicketList.jsx';
import TicketDetail from './crm/TicketDetail.jsx';

export default function Shell({ session }) {
  const [profile, setProfile]   = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [view, setView]         = useState('board');
  const [openItem, setOpenItem] = useState(null);
  const [detailId, setDetailId] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      setProfile(data);
    })();
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
      case 'tasks':
        return <TaskList profile={profile} onSelect={(id) => { setView('task_detail'); setDetailId(id); }} />;
      case 'task_detail':
        return <TaskDetail taskId={detailId} profile={profile} onClose={() => setView('tasks')} />;
      case 'projects':
        return <ProjectList profile={profile} onSelect={(id) => { setView('project_detail'); setDetailId(id); }} />;
      case 'project_detail':
        return <ProjectDetail projectId={detailId} profile={profile}
          onClose={() => setView('projects')}
          onSelectTask={(id) => { setView('task_detail'); setDetailId(id); }} />;
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
      <main className="flex-1 min-w-0 overflow-hidden">
        {renderMain()}
      </main>
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
