
// FF47 — .map() with numeric id converted to string for SelectItem value; expected pattern
declare function SelectItem(props: { value: string; children: unknown }): JSX.Element;
type Project = { id: number; name: string; slug: string };
declare const filteredProjects: Project[];

function ProjectSelector() {
  return (
    <>
      {filteredProjects.map((project) => (
        <SelectItem key={project.id} value={project.id.toString()}>
          {project.name}
        </SelectItem>
      ))}
    </>
  );
}
