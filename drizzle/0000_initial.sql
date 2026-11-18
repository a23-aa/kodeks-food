CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,name TEXT NOT NULL,phone TEXT DEFAULT '',role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),cart TEXT NOT NULL DEFAULT '[]',favorites TEXT NOT NULL DEFAULT '[]',addresses TEXT NOT NULL DEFAULT '[]');
--> statement-breakpoint
CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE restaurants(id INTEGER PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,city TEXT NOT NULL,rating REAL NOT NULL,minutes INTEGER NOT NULL,delivery INTEGER NOT NULL,minimum INTEGER NOT NULL,image TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE dishes(id INTEGER PRIMARY KEY,restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL,discount INTEGER NOT NULL,weight TEXT NOT NULL,image TEXT NOT NULL,available INTEGER NOT NULL,addons TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE promos(code TEXT PRIMARY KEY,kind TEXT NOT NULL,value INTEGER NOT NULL,expires TEXT NOT NULL,max_uses INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE orders(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created TEXT NOT NULL,status INTEGER NOT NULL,total INTEGER NOT NULL,delivery INTEGER NOT NULL,discount INTEGER NOT NULL,promo TEXT,items TEXT NOT NULL,details TEXT NOT NULL,eta TEXT NOT NULL,request_key TEXT);
--> statement-breakpoint
CREATE INDEX orders_user ON orders(user_id,id);
--> statement-breakpoint
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX orders_request_unique ON orders(user_id,request_key) WHERE request_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE login_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
