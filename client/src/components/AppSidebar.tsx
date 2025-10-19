import { BarChart3, TrendingUp, CreditCard, Database, Upload, Home, CalendarRange } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

interface AppSidebarProps {
  uploadId: string | null;
  onNewUpload: () => void;
}

const menuItems = [
  {
    title: 'Обзор',
    url: '/overview',
    icon: Home,
    testId: 'link-overview',
  },
  {
    title: 'Месячный отчет',
    url: '/monthly-report',
    icon: CalendarRange,
    testId: 'link-monthly-report',
  },
  {
    title: 'Аналитика продаж',
    url: '/sales',
    icon: TrendingUp,
    testId: 'link-sales',
  },
  {
    title: 'Анализ платежей',
    url: '/payments',
    icon: CreditCard,
    testId: 'link-payments',
  },
  {
    title: 'Данные',
    url: '/data',
    icon: Database,
    testId: 'link-data',
  },
];

export function AppSidebar({ uploadId, onNewUpload }: AppSidebarProps) {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-border/50 p-4">
        <Link href="/overview">
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-chart-3">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Coffee KPI</h2>
              <p className="text-sm text-muted-foreground">Dashboard</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Аналитика</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={item.testId}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-border/50 p-4">
        {uploadId && (
          <Button
            onClick={onNewUpload}
            variant="outline"
            size="sm"
            className="w-full gap-2"
            data-testid="button-sidebar-new-upload"
          >
            <Upload className="w-4 h-4" />
            Новый файл
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}