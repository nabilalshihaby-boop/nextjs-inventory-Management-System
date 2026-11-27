import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { bridgeAllows, consumeSessionGrant } from "@/lib/session-upgrade";
import { loadAccess } from "@/lib/access-server";
import type { Role } from "@/app/generated/prisma/client";

declare module "next-auth" {
  interface User {
    role?: Role;
    sessionVersion?: number;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      /** Permissions of the user's assigned, ACTIVE operational role (USER only). Resolved from the database on every request. */
      permissions: string[];
      /** USER: assigned warehouses; OWNER / ADMIN: null (unrestricted). */
      warehouseIds: string[] | null;
      /** No warehouse is outside the assignment (OWNER / ADMIN: always). */
      coversAllWarehouses: boolean;
      accessRole: { id: string; name: string } | null;
    } & DefaultSession["user"];
  }
}

// next-auth/jwt only re-exports this module, so the JWT type is augmented at its source.
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    /** User.sessionVersion when this session was issued (server-side only; never in the session response). */
    sv?: number;
  }
}

const credentialsSchema = z.object({
  email: z.email().trim(),
  password: z.string().min(1),
});

// Display fields copied into the JWT, always read from the database (never from client input).
async function readSessionUser(id: string) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, firstName: true, lastName: true, email: true, image: true, role: true, sessionVersion: true },
  });
}

export const {
  handlers,
  auth,
  signIn,
  signOut,
  // Server-only session refresh (used after a profile update). Data passed to it is ignored:
  // the jwt callback re-reads the user from the database instead.
  unstable_update: updateSession,
} = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            image: true,
            role: true,
            sessionVersion: true,
            passwordHash: true,
          },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Only safe fields leave this function — never the hash.
        return {
          id: user.id,
          name: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email,
          image: user.image,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion ?? 0;
        // Display data for the UI (topbar user menu). Never anything secret.
        token.name = user.name ?? null;
        token.email = user.email ?? null;
        token.picture = user.image ?? null;
      }
      // Every later session read (proxy, layouts, pages, Server Actions) re-checks the account in
      // MySQL: the session ends on its very next request if the user was deleted OR their
      // sessionVersion changed (password reset/change), and role / display changes take effect
      // immediately. `trigger: "update"` can be reached by a client POST to /api/auth/session
      // with arbitrary data — that data is never trusted: the token is rebuilt from the database
      // record, and the only way to adopt a new sessionVersion is a one-time server-side grant
      // (lib/session-upgrade.ts) created by the password-change action in the same request.
      else if (token.id) {
        const fresh = await readSessionUser(token.id);
        if (!fresh) return null; // account no longer exists → end the session (cookie cleared)
        if (trigger === "update") {
          const granted = consumeSessionGrant((session as { grant?: unknown } | undefined)?.grant, fresh.id, token.jti);
          if (granted !== null && granted === fresh.sessionVersion) token.sv = granted;
        }
        // Sessions issued before sessionVersion existed carry no value: they count as version 0.
        if ((token.sv ?? 0) !== fresh.sessionVersion) {
          // The one cookie that just changed its own password, read again by Next's same-response
          // re-render (see lib/session-upgrade.ts). Anything else with an old version ends here.
          if (!bridgeAllows(token.jti, fresh.id, fresh.sessionVersion)) return null; // password was reset → end it
          token.sv = fresh.sessionVersion;
        }
        token.name = `${fresh.firstName} ${fresh.lastName}`.trim();
        token.email = fresh.email;
        token.picture = fresh.image;
        token.role = fresh.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      // Operational permissions and warehouse scope are read from MySQL on every session read (never from the cookie, never from the
      // client), so assigning / deactivating a role or changing a scope applies on the very next request.
      const access = token.id ? await loadAccess(token.id) : { permissions: [], warehouseIds: [] as string[] | null, accessRole: null, coversAllWarehouses: false };
      session.user.permissions = access.permissions;
      session.user.warehouseIds = access.warehouseIds;
      session.user.coversAllWarehouses = access.coversAllWarehouses;
      session.user.accessRole = access.accessRole;
      session.user.name = token.name ?? null;
      session.user.email = token.email ?? "";
      session.user.image = token.picture ?? null;
      return session;
    },
  },
});
