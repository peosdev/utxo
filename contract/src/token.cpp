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

#pragma pack(push,1)
struct sign_data {
   uint64_t id;
   checksum256 outputsDigest;
};
#pragma pack(pop)

void token::transferutxo(const name &payer, const std::vector<input> &inputs, const std::vector<output> &outputs, const string &memo) 
{
   utxos utxostable(_self, _self.value);
   require_auth(payer);

   auto p = pack(outputs);
   checksum256 outputsDigest = sha256(&p[0], p.size());

   asset inputSum = asset(0, PEOS_SYMBOL);
   for(auto in = inputs.cbegin() ; in != inputs.cend() ; ++in) {
      sign_data sd = {in->id, outputsDigest};
      checksum256 digest = sha256((const char *)&sd, sizeof(sign_data));

      auto utxo = utxostable.find(in->id);
      check(utxo != utxostable.end(), "Unknown UTXO");
      assert_recover_key(digest, in->sig, utxo->pk);
      inputSum += utxo->amount;

      utxostable.erase(utxo);
   }

   asset outputSum = asset(0, PEOS_SYMBOL);
   for(auto oIter = outputs.cbegin() ; oIter != outputs.cend() ; ++oIter) {
      auto q = oIter->quantity;
      check(q.is_valid(), "Invalid asset");
      check(q.symbol == PEOS_SYMBOL, "Symbol precision mismatch");
      check(q.amount > 0, "Output amount must be positive");
      outputSum += q;

      if (oIter->account.value != 0) 
      {  
         SEND_INLINE_ACTION(*this, transfer, {{_self, "active"_n}}, {_self, oIter->account, q, memo});
      } 
      else 
      {
         utxostable.emplace(payer, [&](auto &u){
            u.id = getNextUTXOId();
            u.pk = oIter->pk;
            u.amount = q;
         });
      }
   }

   check(inputSum >= outputSum, "Inputs don't cover outputs");

   asset fees = inputSum - outputSum;
   if (fees.amount > 0) 
   {  
      SEND_INLINE_ACTION(*this, transfer, {{_self, "active"_n}}, {_self, payer, fees, ""});
   }
}

void token::loadutxo(const name &from, const public_key &pk, const asset &quantity) 
{
   require_auth(from);

   auto sym = quantity.symbol;
   check(sym.is_valid(), "invalid symbol name");

   stats statstable(_self, sym.code().raw());
   auto existing = statstable.find(sym.code().raw());
   check(existing != statstable.end(), "token with symbol does not exist");
   const auto &st = *existing;

   SEND_INLINE_ACTION(*this, transfer, {{from, "active"_n}}, {from, st.issuer, quantity, ""});

   utxos utxostable(_self, _self.value);

   utxostable.emplace(from, [&](auto &u){
      u.id = getNextUTXOId();
      u.pk = pk;
      u.amount = quantity;
   });
}

uint64_t token::getNextUTXOId() 
{
   utxo_globals globals(_self, _self.value);

   uint64_t ret = 0;

   auto const &it = globals.find(0);
   if (it == globals.end()) 
   {
      globals.emplace(_self, [&](auto &g){
         g.next_pk = 1;
      });
   }
   else 
   {
      globals.modify(it, same_payer, [&](auto &g){
         ret = g.next_pk;
         g.next_pk += 1;
      });
   }

   return ret;
}

} // namespace eosio

EOSIO_DISPATCH(eosio::token, (create)(update)(issue)(transfer)(claim)(recover)(retire)(close)(transferutxo)(loadutxo))