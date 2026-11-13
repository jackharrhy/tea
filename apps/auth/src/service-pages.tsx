import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children">;
type Service = {
  id: string;
  name: string;
  description: string;
  kind: string;
  category: string;
  applicationId?: string;
  roles: string[];
  nativeCleanup?: string;
  url?: string;
};
type Application = {
  id: string;
  name: string;
  projectId: string;
  clientIds: string[];
  authorizationHold?: boolean;
};
type Snapshot = {
  checkedAt: string;
  projects: { id: string; name: string; infrastructure?: boolean }[];
  applications: {
    id: string;
    clientId?: string;
    projectId: string;
    name: string;
    callbacks: string[];
    kind: string;
    state: string;
  }[];
};

function ServiceListPage(
  handle: Handle<{
    services: Service[];
    applications: Application[];
    context: Context;
  }>,
) {
  return () => {
    const { services, applications, context } = handle.props;
    return (
      <Document {...context} title="Services" active="services">
        <div class="page-heading">
          <div>
            <h1>Services</h1>
            <p class="muted">
              A catalogue of products, not a list of OAuth client IDs.
            </p>
          </div>
          <a class="button" href="/manage/integrations">
            Technical integrations
          </a>
        </div>
        <div class="table-frame">
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Category</th>
                <th>Integration</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr>
                  <td>
                    <a href={`/manage/services/${service.id}`}>
                      {service.name}
                    </a>
                  </td>
                  <td>{service.category}</td>
                  <td>
                    <span class="status-label">
                      {applications.find(
                        (app) => app.id === service.applicationId,
                      )?.authorizationHold
                        ? "held"
                        : service.kind}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Document>
    );
  };
}

function ServiceDetailPage(
  handle: Handle<{
    service: Service;
    application?: Application;
    context: Context;
  }>,
) {
  return () => {
    const { service, application, context } = handle.props;
    return (
      <Document {...context} title={service.name} active="services">
        <div class="page-heading">
          <div>
            <h1>{service.name}</h1>
            <p class="muted">{service.description}</p>
          </div>
        </div>
        <dl class="profile">
          <div>
            <dt>Integration</dt>
            <dd>{service.kind}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{service.category}</dd>
          </div>
          <div>
            <dt>Service roles</dt>
            <dd>{service.roles.join(", ") || "Separate native permissions"}</dd>
          </div>
          <div>
            <dt>Central boundary</dt>
            <dd>
              {application?.name ||
                "No registered browser application in this catalogue"}
            </dd>
          </div>
          <div>
            <dt>Cleanup</dt>
            <dd>
              {service.nativeCleanup || "Service-specific; must be verified"}
            </dd>
          </div>
        </dl>
        {service.url ? (
          <p>
            <a href={service.url}>Open service</a>
          </p>
        ) : null}
        {application ? (
          <details class="technical">
            <summary>Technical identifiers</summary>
            <p>
              Project: <code>{application.projectId}</code>
            </p>
            <p>
              Clients:{" "}
              {application.clientIds.map((id, index) => (
                <>
                  {index ? ", " : null}
                  <code>{id}</code>
                </>
              ))}
            </p>
          </details>
        ) : null}
        <a class="text-link" href="/manage/services">
          Services
        </a>
      </Document>
    );
  };
}

function IntegrationsPage(
  handle: Handle<{ snapshot: Snapshot; context: Context }>,
) {
  return () => {
    const { snapshot, context } = handle.props;
    return (
      <Document {...context} title="Technical integrations" active="services">
        <div class="page-heading">
          <div>
            <h1>Technical integrations</h1>
            <p class="muted">
              {snapshot.projects.length} native projects and{" "}
              {snapshot.applications.length} application registrations. This is
              an operator inventory snapshot, not proof of consumer login.
            </p>
          </div>
        </div>
        <p class="muted">
          Inventory checked {snapshot.checkedAt}. Infrastructure clients and
          resource credentials are distinct from user-facing apps.
        </p>
        <div class="table-frame">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Registration</th>
                <th>Type / state</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.projects.flatMap((project) => {
                const registered = snapshot.applications.filter(
                  (app) => app.projectId === project.id,
                );
                if (!registered.length)
                  return (
                    <tr>
                      <td>{project.name}</td>
                      <td>No browser/resource registrations</td>
                      <td>
                        {project.infrastructure
                          ? "Infrastructure"
                          : "Directory eligibility"}
                      </td>
                    </tr>
                  );
                return registered.map((app) => (
                  <tr>
                    <td>
                      {project.name}
                      {project.infrastructure ? (
                        <span class="table-subline">Issuer infrastructure</span>
                      ) : null}
                    </td>
                    <td>
                      {app.name}
                      <details>
                        <summary>Identifiers and callbacks</summary>
                        <p>
                          <code>{app.clientId || app.id}</code>
                        </p>
                        {app.callbacks.map((callback) => (
                          <p>
                            <code>{callback}</code>
                          </p>
                        ))}
                      </details>
                    </td>
                    <td>
                      {app.kind}
                      <span class="table-subline">
                        {app.state.replace("APP_STATE_", "").toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
        <a class="text-link" href="/manage/services">
          Services
        </a>
      </Document>
    );
  };
}

export function renderServiceList(
  services: Service[],
  applications: Application[],
  context: Context,
  nonce: string,
) {
  return renderToString(
    <ServiceListPage
      services={services}
      applications={applications}
      context={context}
    />,
    { nonce },
  );
}

export function renderServiceDetail(
  service: Service,
  application: Application | undefined,
  context: Context,
  nonce: string,
) {
  return renderToString(
    <ServiceDetailPage
      service={service}
      application={application}
      context={context}
    />,
    { nonce },
  );
}

export function renderIntegrations(
  snapshot: Snapshot,
  context: Context,
  nonce: string,
) {
  return renderToString(
    <IntegrationsPage snapshot={snapshot} context={context} />,
    { nonce },
  );
}
