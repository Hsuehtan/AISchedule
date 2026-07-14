export type ProjectRecord = {
  id: string;
  userId: string;
  name: string;
  colorKey: string;
  status: string;
  archivedAt: Date | null;
  taskCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export function presentProject(project: ProjectRecord) {
  return {
    id: project.id,
    userId: project.userId,
    name: project.name,
    colorKey: project.colorKey,
    status: project.status,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    taskCount: project.taskCount,
    version: project.version,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}
