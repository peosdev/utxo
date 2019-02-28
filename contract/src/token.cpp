/**
 *  @file
 *  @copyright defined in eos/LICENSE.txt
 */

#include <token.hpp>

namespace eosio
{

const uint32_t seconds_per_day = 24 * 3600;

void token::create(name issuer,
                   asset maximum_supply)
{
   require_auth(_self);

   auto sym = maximum_supply.symbol;
   check(sym.is_valid(), "invalid symbol name");
   check(maximum_supply.is_valid(), "invalid supply");
   check(maximum_supply.amount > 0, "max-supply must be positive");

   stats statstable(_self, sym.code().raw());
   auto existing = statstable.find(sym.code().raw());

   check(existing == statstable.end(), "token with symbol already exists");
   
   statstable.emplace(_self, [&](auto &s) {
      s.supply.symbol = maximum_supply.symbol;
      s.max_supply = maximum_supply;
      s.issuer = issuer;
   });
}

void token::update(name issuer,
                   asset maximum_supply)
{
   require_auth(_self);

   auto sym = maximum_supply.symbol;
   check(sym.is_valid(), "invalid symbol name");
   check(maximum_supply.is_valid(), "invalid supply");
   check(maximum_supply.amount > 0, "max-supply must be positive");

   stats statstable(_self, sym.code().raw());
   auto existing = statstable.find(sym.code().raw());
   
   check(existing != statstable.end(), "token with symbol doesn't exists");

   const auto& st = *existing;

   check(st.supply.amount <= maximum_supply.amount, "max_supply must be larger that available supply");
   check(maximum_supply.symbol == st.supply.symbol, "symbol precission mismatch");
   
   statstable.modify(st, same_payer, [&](auto &s) {
      s.max_supply = maximum_supply;
      s.issuer = issuer;
   });
}

void token::issue(name to, asset quantity, string memo)
{
   auto sym = quantity.symbol;
   check(sym.is_valid(), "invalid symbol name");
   check(memo.size() <= 256, "memo has more than 256 bytes");

   stats statstable(_self, sym.code().raw());
   auto existing = statstable.find(sym.code().raw());
   check(existing != statstable.end(), "token with symbol does not exist, create token before issue");
   const auto &st = *existing;

   require_auth(st.issuer);
   check(quantity.is_valid(), "invalid quantity");
   check(quantity.amount > 0, "must issue positive quantity");

   check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
   check(quantity.amount <= st.max_supply.amount - st.supply.amount, "quantity exceeds available supply");

   statstable.modify(st, same_payer, [&](auto &s) {
      s.supply += quantity;
   });

   add_balance(st.issuer, quantity, st.issuer, true);

   if (to != st.issuer)
   {
      SEND_INLINE_ACTION(*this, transfer, {{st.issuer, "active"_n}},
                         {st.issuer, to, quantity, memo});
   }
}

void token::retire(asset quantity, string memo)
{
   auto sym = quantity.symbol;
   check(sym.is_valid(), "invalid symbol name");
   check(memo.size() <= 256, "memo has more than 256 bytes");

   stats statstable(_self, sym.code().raw());
   auto existing = statstable.find(sym.code().raw());
   check(existing != statstable.end(), "token with symbol does not exist");
   const auto &st = *existing;

   require_auth(st.issuer);
   check(quantity.is_valid(), "invalid quantity");
   check(quantity.amount > 0, "must retire positive quantity");

   check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");

   statstable.modify(st, same_payer, [&](auto &s) {
      s.supply -= quantity;
   });

   sub_balance(st.issuer, quantity);
}

void token::transfer(name from,
                     name to,
                     asset quantity,
                     string memo)
{
   check(from != to, "cannot transfer to self");
   require_auth(from);
   check(is_account(to), "to account does not exist");
   auto sym = quantity.symbol.code();
   stats statstable(_self, sym.raw());
   const auto &st = statstable.get(sym.raw());

   require_recipient(from);
   require_recipient(to);

   check(quantity.is_valid(), "invalid quantity");
   check(quantity.amount > 0, "must transfer positive quantity");
   check(quantity.symbol == st.supply.symbol, "symbol precision mismatch");
   check(memo.size() <= 256, "memo has more than 256 bytes");

   auto payer = has_auth(to) ? to : from;

   do_claim(from, sym, from);
   sub_balance(from, quantity);
   add_balance(to, quantity, payer, payer != st.issuer);

   if (from != st.issuer)
   {
      do_claim(to, sym, from);
   }
}

void token::claim(name owner, symbol_code sym)
{
   do_claim(owner, sym, owner);
}

void token::do_claim(name owner, symbol_code sym, name payer)
{
   require_auth(payer);

   check(sym.is_valid(), "Invalid symbol name");

   accounts acnts(_self, owner.value);

   const auto &owner_acc = acnts.get(sym.raw(), "no balance object found");

   if (!owner_acc.claimed)
   {
      auto balance = owner_acc.balance;

      acnts.erase(owner_acc);

      auto replace = acnts.find(sym.raw());
      check(replace == acnts.end(), "There must be no balance object");

      acnts.emplace(payer, [&](auto &a) {
         a.balance = balance;
         a.claimed = true;
      });
   }
}

void token::recover(name owner, symbol_code sym)
{
   check(sym.is_valid(), "invalid symbol name");

   stats statstable(_self, sym.raw());
   auto existing = statstable.find(sym.raw());
   check(existing != statstable.end(), "token with symbol does not exist");
   const auto &st = *existing;

   require_auth(st.issuer);

   accounts acnts(_self, owner.value);

   const auto owner_acc = acnts.find(sym.raw());
   if(owner_acc != acnts.end() && !owner_acc->claimed) {      
      add_balance(st.issuer, owner_acc->balance, st.issuer, true);
      acnts.erase(owner_acc);
   }
}

void token::sub_balance(name owner, asset value)
{
   accounts from_acnts(_self, owner.value);

   const auto &from = from_acnts.get(value.symbol.code().raw(), "no balance object found");
   check(from.balance.amount >= value.amount, "overdrawn balance");

   from_acnts.modify(from, owner, [&](auto &a) {
      a.balance -= value;
      a.claimed = true;
   });
}

void token::add_balance(name owner, asset value, name ram_payer, bool claimed)
{
   accounts to_acnts(_self, owner.value);
   auto to = to_acnts.find(value.symbol.code().raw());
   if (to == to_acnts.end())
   {
      to_acnts.emplace(ram_payer, [&](auto &a) {
         a.balance = value;
         a.claimed = claimed;
      });
   }
   else
   {
      to_acnts.modify(to, same_payer, [&](auto &a) {
         a.balance += value;
      });
   }
}

void token::open(name owner, const symbol &symbol, name ram_payer)
{
   require_auth(ram_payer);

   auto sym_code_raw = symbol.code().raw();

   stats statstable(_self, sym_code_raw);
   const auto &st = statstable.get(sym_code_raw, "symbol does not exist");
   check(st.supply.symbol == symbol, "symbol precision mismatch");

   accounts acnts(_self, owner.value);
   auto it = acnts.find(sym_code_raw);
   if (it == acnts.end())
   {
      acnts.emplace(ram_payer, [&](auto &a) {
         a.balance = asset{0, symbol};
         a.claimed = true;
      });
   }
}

void token::close(name owner, const symbol &symbol)
{
   require_auth(owner);
   accounts acnts(_self, owner.value);
   auto it = acnts.find(symbol.code().raw());
   check(it != acnts.end(), "Balance row already deleted or never existed. Action won't have any effect.");
   check(it->balance.amount == 0, "Cannot close because the balance is not zero.");
   acnts.erase(it);
}

} // namespace eosio

EOSIO_DISPATCH(eosio::token, (create)(update)(issue)(transfer)(claim)(recover)(retire)(close))